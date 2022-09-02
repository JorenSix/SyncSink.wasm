var taskQueue = [];
var verbose = true;
var chart;

window.onload = function() {
	document.getElementById('uploader').addEventListener('change', addToFileQueue);

	window.addEventListener('dragenter', dragEnterHandler);

	document.getElementById("drop_zone").addEventListener('dragenter', dragEnterHandler);
	document.getElementById("drop_zone").addEventListener('dragleave', dragLeaveHandler);
	document.getElementById("drop_zone").addEventListener('drop', dropHandler);
	document.getElementById("drop_zone").addEventListener('dragover', dragOverHandler);

	document.getElementById('uploader_button').addEventListener('click', () => {document.getElementById('uploader').click();});

	initializeChart();
};

function dragOverHandler(ev) { ev.preventDefault();}
function dragEnterHandler(ev){ document.getElementById("drop_zone").style.display = "flex";}
function dragLeaveHandler(ev){ 	document.getElementById("drop_zone").style.display = "none";}

async function dropHandler(ev) {
	dragLeaveHandler();

	// Prevent default behavior (Prevent file from being opened)
	ev.preventDefault();

	if (ev.dataTransfer.items) {
	  // Use DataTransferItemList interface to access the file(s)
	  for (var i = 0; i < ev.dataTransfer.items.length; i++) {
	    // If dropped items aren't files, reject them
	    if (ev.dataTransfer.items[i].kind === 'file') {
	      var file = ev.dataTransfer.items[i].getAsFile();
	      addToQueue(file);
	    }
	  }
	  
	} else {
	  // Use DataTransfer interface to access the file(s)
	  for (var i = 0; i < ev.dataTransfer.files.length; i++) {
	    addToQueue(files[i]);
	  }
	}

	if(taskQueue.length > 0 ) processTaskQueue(taskQueue,addInterfaceElements,updateInterfaceElements,onDuration,onProgress);
}

function downloadBlob(blob, name = 'file.txt') {
  // Convert your blob into a Blob URL (a special url that points to an object in the browser's memory)
  const blobUrl = URL.createObjectURL(blob);

  // Create a link element
  const link = document.createElement("a");

  // Set link's href to point to the Blob URL
  link.href = blobUrl;
  link.download = name;

  // Append link to the body
  document.body.appendChild(link);

  // Dispatch click event on the link
  // This is necessary as link.click() does not work on the latest firefox
  link.dispatchEvent(
    new MouseEvent('click', { 
      bubbles: true, 
      cancelable: true, 
      view: window 
    })
  );

  // Remove link from body
  document.body.removeChild(link);
}


function initializeChart(){
        const ctx = document.getElementById('myChart').getContext('2d');
        chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Audio files',
                    data: [],
                    backgroundColor: [ ]
                }]
            },
            options: {
              indexAxis: 'y',
                scales: {
                    x: {
                        beginAtZero: false,
                        title: {display: true, text: "Time (seconds)"}
                    }
                }
            }
        });
}

//Duration received
function onDuration(duration){updateChart();}

//add a file to te sync queue
function addToQueue(file){
	var newExt = ""
	var inputFile = new MediaFile(file.name);
	taskQueue.push(new SyncTask(inputFile));

	inputFile.buffer =  file.arrayBuffer();        

	console.log("Add to queue ",taskQueue);
}

//progress of current task
function onProgress(progress){
	const progress_bar = document.getElementById("progress_bar");
	const progress_container = document.getElementById("progress_container");
	if(progress == 100){
	  progress_container.style["visibility"] = "hidden";
	  progress_bar.style["width"] =  "0%";
	  progress_bar.textContent =  "0%";
	}else{
	  progress_container.style["visibility"] = "visible";
	  progress_bar.style["width"] = progress + "%";
	  progress_bar.textContent = progress + "%";
	}
}

function addInterfaceElements(index, fileQueueElement){
	var hidden_elements = document.getElementsByClassName('result');
	for (var i = 0; i < hidden_elements.length; ++i) {
    	hidden_elements[i].style["display"]="grid";
	}
    updateChart();
}

function color(index) {
	const COLORS = ['#4dc9f6','#f67019','#f53794','#537bc4','#acc236','#166a8f','#00a950','#58595b','#8549ba'];
	return COLORS[index % COLORS.length];
}

function downloadInfo(taskIndex){
	
	var ref_filename = taskQueue[0].input_file.file_name;
	var ref_duration = taskQueue[0].input_file.duration;

	let jsonObject = { 
		reference: {
			filename: ref_filename,
			duration: ref_duration
		},
		synchronized_files: [
		]
	};

	for(var taskIndex = 1 ; taskIndex < taskQueue.length ; taskIndex++){
      const task = taskQueue[taskIndex];
      var duration = task.input_file.duration;
      var filename = task.input_file.file_name;
      var offset =  task.offset;

      var subJsonObject = {
      	offset: offset,
      	filename: filename,
      	duration: duration,
      	index: taskIndex,
      	match: {
      		time_difference_in_s: task.best_match_info[0] / 1000.0,
      		filtered_matches_length:  task.best_match_info[1],
      		match_duration_in_s: task.best_match_info[2] / 1000.0,
      		match_percentage: task.best_match_info[3] * 100.0,
      		match_time_factor: task.best_match_info[4] * 100.0,
      		filtered_matches: task.best_match_info[5]
      	}
      }

      //change time from fft index to seconds:
      for(var index=0 ; index < subJsonObject.match.filtered_matches.length; index++){
        subJsonObject.match.filtered_matches[index].match_time = 128.0/16000.0 * subJsonObject.match.filtered_matches[index].match_time;
        subJsonObject.match.filtered_matches[index].query_time = 128.0/16000.0 * subJsonObject.match.filtered_matches[index].query_time; 
        subJsonObject.match.filtered_matches[index].delta = 128.0/16000.0 * subJsonObject.match.filtered_matches[index].delta; 
      }

      jsonObject.synchronized_files.push(subJsonObject)

    }

    console.log("Download JSON info file for ",taskIndex);
	var blob = new Blob([JSON.stringify(jsonObject)], {type: "application/json"});

	downloadBlob(blob, ref_filename +".json")
}

function removeTask(taskIndex){
	console.log("Remove ",taskIndex);
	taskQueue.splice(taskIndex, 1);
	removeFromChart(taskIndex);

	const tbody = document.getElementById("result_tbody");
	tbody.removeChild(tbody.children[taskIndex]);

	updateChart();
}

function clearTable(){
	
	tbody.innerHTML = "";
}
function setReference(taskIndex){
	if(taskIndex == 0) return;

	//switch tasks
	var newRef = taskQueue[taskIndex];
	taskQueue[taskIndex] = taskQueue[0];
	taskQueue[0] = newRef;


	updateChart();
	updateTable();
}

function updateTable(){
	const tbody = document.getElementById("result_tbody");
	for(var taskIndex = 0 ; taskIndex < taskQueue.length ; taskIndex++){
		const task = taskQueue[taskIndex];
		const duration = task.input_file.duration || 10.123;
		const filename = task.input_file.file_name;
		var row = null;

		if(taskIndex == tbody.children.length){
			row = document.createElement('tr');
			row.id = "task_" + taskIndex;
			//add 6 tds
			for(var i = 0 ; i < 6 ; i++){
				var td = document.createElement('td');
				td.classList.add("align-middle");
				row.appendChild(td);
			}
			tbody.appendChild(row);
		}

		row = document.getElementById("task_" + taskIndex);
		row.children[0].innerHTML = "<img src='images/audio.svg'>";

		if(row.children[1].children.length == 1){
			var audio = row.children[1].children[1];
			if(task.finished) {
				const blobUrl = URL.createObjectURL(task.output_file.asBlob());
         		audio.src = blobUrl;
         	}
		}else {
			//var audio = document.createElement('audio');
        	//audio.controls = true;
         	//row.children[1].appendChild(audio);
		}
	
		row.children[1].innerHTML = "<tt>" + filename + "</tt>  ";
		if(task.processed && task.best_match_info){
			var score = task.best_match_info[1];
			var time_scale_factor = task.best_match_info[4];
			time_scale_factor
			row.children[3].innerHTML = score + " matches over " +  ~~(task.best_match_info[2] / 1000) + "s"
			row.children[2].innerHTML = "" + ~~(100 * time_scale_factor) + "%";
			var pct = ~~(task.best_match_info[3] * 100);
			row.children[4].innerHTML = '<div class="progress" style="width:20vw;"><div class="progress-bar bg-success" role="progressbar" id="match_indicator" style="width: ' + pct + '%" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' + pct + '%</div></div>'
		}
		row.children[5].innerHTML = '<a href="#" onclick="setReference('+ taskIndex+');return false;"><img src="images/flag.svg"></a> <a href="#" onclick="removeTask(' + taskIndex + ');return false;" ><img src="images/cross.svg"></a>';
	}
}

function removeFromChart(index){
	chart.data.labels.splice(index,1);
	chart.data.datasets[0].data.splice(index,1);
	chart.data.datasets[0].backgroundColor.splice(index,1);;
}

function updateChart(){
	updateTable();

    //clear
    if(taskQueue.length == 0){
      console.log("Clear chart")
      chart.data.labels.length = 0;
      chart.data.datasets[0].data.length = 0;
      chart.data.datasets[0].backgroundColor.length =0;
    }

    for(var taskIndex = 0 ; taskIndex < taskQueue.length ; taskIndex++){
      const task = taskQueue[taskIndex];
      var duration = task.input_file.duration || 10.123;
      var filename = task.input_file.file_name;
      var offset =  task.offset;

      console.log("Update chart for ",duration,taskIndex)

      if(chart.data.labels.length == taskIndex){
        chart.data.labels.push(filename);
        chart.data.datasets[0].data.push([0,duration]);
        chart.data.datasets[0].backgroundColor.push('#CECECE');
      }else{
        chart.data.labels[taskIndex] = filename;
        chart.data.datasets[0].data[taskIndex] = [offset,offset+duration];
        chart.data.datasets[0].backgroundColor[taskIndex] = color(taskIndex);
      }
    }

    chart.update();
}

function updateInterfaceElements(index, fileQueueElement){
    updateChart();
    updateTable();
}
      
function addToFileQueue(ev){
    fileList = ev.target.files;
    for (var i = 0; i < fileList.length; i++) {
      console.log(fileList[i].name);
      addToQueue(files[i]);
    }
    processTaskQueue(taskQueue,addInterfaceElements,updateInterfaceElements,onDuration,onProgress);
}


function sync(trimmed){
    syncTaskQueue(trimmed,taskQueue, (a) => {

      var blob = new Blob([a], {type : 'audio/wav'});

      //var audio = document.getElementById("test");
      //audio.src = URL.createObjectURL(new Blob([a], { type: 'audio/wav'}));
      const ext = taskQueue[0].input_file.extension();
      const ref_file_name = taskQueue[0].input_file.file_name;
      var tr_name = "_extended_";
      if (trimmed) tr_name = "_trimmed_" ;
      const output_file_name = ref_file_name.replace("."+ext,trimmed + "_synced.wav");

      downloadBlob(blob,output_file_name);
    }); 
}

function reset(){
    console.log("clear");
    taskQueue = [];
    updateChart();
}

